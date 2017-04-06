#!/usr/bin/perl -w

use Getopt::Long;
use JSON;
use File::Slurp;
use Data::Dumper;

# A script used for testing. Meant to be used only by me.
my @options = ();
my $sure;
GetOptions(
  "t=s" => \@options,
  "y" => \$sure
);
die "usage: $0 -t <trip name>" if !@options;

if(!$sure) {
  print "Are you sure? [y/n]: ";
  while(<>) {
    chomp;
    exit if($_ ne "y");
    last;
  }
}

foreach my $t (@options)
{
  # my $trip = lc $options{t};
  my $trip = lc $t;
  print "Now handling trip $t\n";
  $trip =~ s/ /_/g;
  
  # Delete from all sessions.
  my $baseDir = "/home/ec2-user";
  my $sessionDir = "$baseDir/sessions";
  opendir(DIR,$sessionDir) || die $!;
  while(my $file = readdir DIR) {
    # ignore files starting with "."
    next if($file =~ /^\./); 
    $sessionFile = "$sessionDir/$file";
    my $content = eval { decode_json(read_file("$sessionFile")) };
    my $trips = $content->{'trips'};
  
    my $contentUpdated = 0;
    if(defined $trips->{$trip}) {
      delete $trips->{$trip};
      $contentUpdated = 1;
    }
    if(defined($content->{'tripNameInContext'}) && ($content->{'tripNameInContext'} eq $trip)) {
      print "Deleting trip name in context from file $sessionFile\n";
      delete $content->{'tripNameInContext'};
      delete $content->{'rawTripNameInContext'};
      $contentUpdated = 1;
    }
    next if (!$contentUpdated);
    # copy file to orig, just to be safe.
    write_file("$sessionDir/.$file.orig",read_file("$sessionFile")) || die $!;
    print "Removing trip $trip from file $sessionFile\n";
    # Now write the updated content into file
    write_file($sessionFile, encode_json($content)) || die $!;
  }
  
  # Finally, delete the trip file from "trips" directory
  print "Removing trip file trips/$trip.txt and trips/$trip-data.txt\n";
  my $tripDir = "$baseDir/trips";
  `mv $tripDir/$trip.txt $tripDir/.$trip.txt.orig` if -e "$tripDir/$trip.txt";
  `mv $tripDir/$trip-data.txt $tripDir/.$trip-data.txt.orig` if -e "$tripDir/$trip-data.txt";
  `mv $tripDir/$trip-itinerary.txt $tripDir/.$trip-itinerary.txt.orig` if -e "$tripDir/$trip-itinerary.txt";
}
